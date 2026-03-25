const { spawn } = require('child_process');

const opencodePath = 'C:\\nvm4w\\nodejs\\opencode.cmd';
const command = `& "${opencodePath}" serve --hostname 127.0.0.1 --port 4096`;

console.log('Test 1: without detached');
const child1 = spawn('powershell.exe', ['-Command', command], {
  cwd: process.cwd(),
  stdio: 'ignore'
});
child1.unref();
console.log('Spawned without detached, PID:', child1.pid);

setTimeout(() => {
  const http = require('http');
  const req = http.request('http://localhost:4096/global/health', (res) => {
    console.log('✅ Test 1 PASSED! Service running! Status:', res.statusCode);
    process.exit(0);
  });
  req.on('error', () => {
    console.log('❌ Test 1 FAILED, trying test 2...');
    tryAgain();
  });
  req.end();
}, 3000);

function tryAgain() {
  console.log('\nTest 2: with detached + no stdin');
  const child2 = spawn('powershell.exe', ['-Command', command], {
    cwd: process.cwd(),
    stdio: 'pipe',
    detached: true
  });
  child2.unref();
  console.log('Spawned with detached, PID:', child2.pid);
  
  setTimeout(() => {
    const req2 = http.request('http://localhost:4096/global/health', (res) => {
      console.log('✅ Test 2 PASSED! Service running! Status:', res.statusCode);
      process.exit(0);
    });
    req2.on('error', (err) => {
      console.error('❌ Both tests failed:', err.message);
      process.exit(1);
    });
    req2.end();
  }, 3000);
}