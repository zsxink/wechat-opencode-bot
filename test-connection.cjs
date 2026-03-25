const http = require('http');

console.log('正在测试 OpenCode 服务连接...');

// 测试连接到 OpenCode 服务
const req = http.request('http://localhost:4096/global/health', (res) => {
  console.log('状态码:', res.statusCode);
  console.log('响应头:', res.headers);
  
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('响应数据:', data);
  });
});

req.on('error', (err) => {
  console.error('连接到 OpenCode 服务失败:', err);
  process.exit(1);
});

req.end();