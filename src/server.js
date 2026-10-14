require('dotenv').config();

const app = require('./app');
const { startCronJobs } = require('./services/cronService');

const PORT = Number(process.env.PORT) || 3000;

console.log(`[server] ${new Date().toISOString()} pid=${process.pid} starting port=${PORT}`);

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`[server] ${new Date().toISOString()} pid=${process.pid} ready port=${PORT}`);
  startCronJobs();
});

server.on('error', (error) => {
  console.error(`[server] ${new Date().toISOString()} pid=${process.pid} listen failed code=${error.code || 'UNKNOWN'}`);
  throw error;
});

process.on('uncaughtExceptionMonitor', (error, origin) => {
  console.error(`[server] ${new Date().toISOString()} pid=${process.pid} fatal origin=${origin} name=${error.name}`);
});

process.on('exit', (code) => {
  console.log(`[server] ${new Date().toISOString()} pid=${process.pid} exit code=${code}`);
});
