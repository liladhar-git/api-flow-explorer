const express = require('express');
const legacy = require('./legacy');
const cyc = require('./cycle');

const app = express();
const V = '/v1';
const routers = {};

app.get('env');
app.use(V + '/legacy', legacy);
app.use('/dyn', routers[process.argv[2]]);
app.use('/cycle', cyc.a);
app.get(/^\/re/, handler);
app.all('/any', (req, res) => res.send('any'));
app.get(['/a', '/b'], (req, res) => res.send('ab'));
app.get(`${V}/tpl/:id`, handler);
app.use(express.static('public'));

function handler(req, res) {
  res.send('ok');
}
