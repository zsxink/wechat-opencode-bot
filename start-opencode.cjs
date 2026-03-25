const { spawn } = require('child_process');

console.log('正在启动 OpenCode 服务...');

const child = spawn('opencode', ['serve', '--hostname', '127.0.0.1', '--port', '4096'], {
  stdio: 'ignore',
  detached: true
});

child.unref();
console.log('OpenCode 服务已启动');