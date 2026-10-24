const { Router } = require('express');
const a = Router();
const b = Router();
a.use('/b', b);
b.use('/a', a);
a.get('/x', (req, res) => res.end());
module.exports = { a, b };
