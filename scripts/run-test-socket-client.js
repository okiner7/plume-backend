const { spawn, execSync } = require('child_process');

async function run() {
  const PORT = 3005;
  console.log(`[Runner] Spawning server on port ${PORT}...`);

  const serverProc = spawn('node', ['-e', `
    process.env.PORT = ${PORT};
    const app = require('./src/server');
    app.server.listen(${PORT}, () => console.log('SERVER_READY'));
  `], { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'pipe'] });

  let serverOutput = '';
  await new Promise((resolve, reject) => {
    serverProc.stdout.on('data', (data) => {
      const str = data.toString();
      serverOutput += str;
      if (str.includes('SERVER_READY')) resolve();
    });
    serverProc.stderr.on('data', (data) => {
      serverOutput += data.toString();
    });
    serverProc.on('error', reject);
    serverProc.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Server exited with code ${code}: ${serverOutput}`));
    });
  });

  console.log(`[Runner] Server ready on http://localhost:${PORT}`);

  try {
    const output = execSync(`node scripts/test-socket-client.js http://localhost:${PORT}`, {
      encoding: 'utf8',
      cwd: process.cwd(),
      env: { ...process.env, JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production' }
    });
    console.log(output);
  } catch (err) {
    console.error('Execution failed:');
    if (err.stdout) console.log(err.stdout);
    if (err.stderr) console.error(err.stderr);
    process.exitCode = 1;
  } finally {
    serverProc.kill();
  }
}

run();
