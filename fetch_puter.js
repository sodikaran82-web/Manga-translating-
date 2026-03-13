const https = require('https');
https.get('https://js.puter.com/v2/', (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => { console.log(data.substring(0, 1000)); });
});
