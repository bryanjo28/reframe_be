require('dotenv').config();

const app = require('./app');
const { startCronJobs } = require('./services/cronService');

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  startCronJobs();
});
