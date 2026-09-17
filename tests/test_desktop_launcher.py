import importlib.util
from contextlib import closing
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch, MagicMock
spec = importlib.util.spec_from_file_location('launcher', Path(__file__).parents[1] / 'desktop/launch.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
    def test_runtime_paths_use_appdata_and_allow_explicit_overrides(self):
        paths = launcher.resolve_runtime_paths({'APPDATA': r'C:\Users\tester\AppData\Roaming'})
        self.assertEqual(paths.data_dir, Path(r'C:\Users\tester\AppData\Roaming') / 'Daily Plan')
        self.assertEqual(paths.database, paths.data_dir / 'data.db')

        overridden = launcher.resolve_runtime_paths({
            'APPDATA': r'C:\ignored',
            'DAILY_PLAN_DATA_DIR': r'D:\DailyPlanData',
            'DAILY_PLAN_DB_PATH': r'E:\databases\daily.db',
        })
        self.assertEqual(overridden.data_dir, Path(r'D:\DailyPlanData'))
        self.assertEqual(overridden.database, Path(r'E:\databases\daily.db'))

    def test_legacy_database_is_copied_and_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'legacy.db'
            destination = root / 'appdata' / 'data.db'
            with closing(sqlite3.connect(source)) as connection:
                connection.execute('CREATE TABLE sample(value TEXT)')
                connection.execute("INSERT INTO sample VALUES ('legacy')")
                connection.commit()

            self.assertTrue(launcher.migrate_legacy_database(source, destination))
            with closing(sqlite3.connect(destination)) as connection:
                self.assertEqual(connection.execute('SELECT value FROM sample').fetchone()[0], 'legacy')
                connection.execute("UPDATE sample SET value='current'")
                connection.commit()

            self.assertFalse(launcher.migrate_legacy_database(source, destination))
            with closing(sqlite3.connect(destination)) as connection:
                self.assertEqual(connection.execute('SELECT value FROM sample').fetchone()[0], 'current')
            with closing(sqlite3.connect(source)) as connection:
                self.assertEqual(connection.execute('SELECT value FROM sample').fetchone()[0], 'legacy')

    def test_failed_migration_keeps_source_and_creates_no_destination(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'legacy.db'
            destination = root / 'appdata' / 'data.db'
            original = b'not a sqlite database'
            source.write_bytes(original)

            with self.assertRaises(sqlite3.DatabaseError):
                launcher.migrate_legacy_database(source, destination)
            self.assertEqual(source.read_bytes(), original)
            self.assertFalse(destination.exists())

    def test_migration_includes_committed_wal_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / 'legacy.db'
            destination = root / 'appdata' / 'data.db'
            writer = sqlite3.connect(source)
            try:
                writer.execute('PRAGMA journal_mode=WAL')
                writer.execute('PRAGMA wal_autocheckpoint=0')
                writer.execute('CREATE TABLE sample(value TEXT)')
                writer.execute("INSERT INTO sample VALUES ('committed-in-wal')")
                writer.commit()

                self.assertTrue(launcher.migrate_legacy_database(source, destination))
                with closing(sqlite3.connect(destination)) as migrated:
                    self.assertEqual(
                        migrated.execute('SELECT value FROM sample').fetchone()[0],
                        'committed-in-wal',
                    )
            finally:
                writer.close()

    def test_desktop_environment_marks_only_a_reused_backend(self):
        with patch.dict(launcher.os.environ, {'DAILY_PLAN_EXISTING_BACKEND_PORT': '9000'}):
            reused = launcher.desktop_environment(True)
            fresh = launcher.desktop_environment(False)
        self.assertEqual(reused['DAILY_PLAN_EXISTING_BACKEND_PORT'], '8000')
        self.assertNotIn('DAILY_PLAN_EXISTING_BACKEND_PORT', fresh)

    def test_foreign_service_is_not_accepted(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true,"appId":"other","apiVersion":2}'
        with patch.object(launcher.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = response
            self.assertFalse(launcher.backend_ready())

if __name__ == '__main__':
    unittest.main()
