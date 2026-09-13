const {test}=require('node:test');
const assert=require('node:assert/strict');
const FocusClock=require('../floating/clock.js');
test('integer polling preserves fractional seconds and never moves backwards',()=>{let t=0;const c=new FocusClock(()=>t);c.accept({sessionId:'a',status:'running',elapsedSeconds:0});t=1900;c.accept({sessionId:'a',status:'running',elapsedSeconds:1});t=2100;assert.equal(Math.floor(c.seconds()),2);t=3900;c.accept({sessionId:'a',status:'running',elapsedSeconds:3});t=4100;assert.equal(Math.floor(c.seconds()),4)});
test('pause freezes, resume advances, new sessions reset and idle clears',()=>{let t=0;const c=new FocusClock(()=>t);c.accept({sessionId:'a',status:'paused',elapsedSeconds:12});t=10000;assert.equal(c.seconds(),12);c.accept({sessionId:'a',status:'running',elapsedSeconds:12});t=11000;assert.equal(c.seconds(),13);c.accept({sessionId:'b',status:'running',elapsedSeconds:0});assert.equal(c.seconds(),0);c.accept(null);t=90000;assert.equal(c.seconds(),0)});
