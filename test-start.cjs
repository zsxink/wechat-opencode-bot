const { exec } = require('child_process');

const cwd = 'C:\\Users\\xian\\Project\\AiProject\\opencode\\wechat';
const cmd = `powershell -NoProfile -Command "Start-Process -FilePath opencode -ArgumentList 'serve','--hostname','127.0.0.1','--port','4096' -WorkingDirectory '${cwd}' -WindowStyle Hidden -PassThru | Select-Object -ExpandProperty Id"`;

console.log('Running:', cmd);

exec(cmd, { windowsHide: true }, (err, stdout, stderr) => {
  if (err) {
    console.error('Error:', err.message);
    return;
  }
  console.log('stdout:', stdout.trim());
  if (stderr) console.log('stderr:', stderr);
});

setTimeout(() => {
  console.log('Check port...');
  require('child_process').execSync('netstat -ano | findstr :4096', { encoding: 'utf-8' });
}, 3000);
