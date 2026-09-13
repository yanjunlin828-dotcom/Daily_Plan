import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
spec = importlib.util.spec_from_file_location('launcher', Path(__file__).parents[1] / 'desktop/launch.py')
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)

class LauncherTests(unittest.TestCase):
    def test_healthy_backend_is_reused(self):
        with patch.object(launcher, 'backend_ready', return_value=True), patch.object(launcher.subprocess, 'Popen') as spawn:
            launcher.ensure_backend()
            spawn.assert_not_called()

    def test_cold_start_waits_for_health(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(launcher, 'STATE', Path(tmp)), patch.object(launcher, 'backend_ready', side_effect=[False, False, True]), patch.object(launcher.subprocess, 'Popen') as spawn, patch.object(launcher.time, 'sleep'):
            spawn.return_value.poll.return_value = None
            launcher.ensure_backend()
            self.assertIn('127.0.0.1', spawn.call_args.args[0])
            self.assertIn('uvicorn', spawn.call_args.args[0])
            self.assertEqual(spawn.call_count, 1)

    def test_failed_backend_is_reported(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(launcher, 'STATE', Path(tmp)), patch.object(launcher, 'backend_ready', return_value=False), patch.object(launcher.subprocess, 'Popen') as spawn:
            spawn.return_value.poll.return_value = 1
            with self.assertRaises(RuntimeError):
                launcher.ensure_backend()

    def test_foreign_service_is_not_accepted(self):
        response = MagicMock()
        response.__enter__.return_value.read.return_value = b'{"ok":true,"appId":"other","apiVersion":2}'
        with patch.object(launcher.urllib.request, 'build_opener') as opener:
            opener.return_value.open.return_value = response
            self.assertFalse(launcher.backend_ready())

if __name__ == '__main__':
    unittest.main()
