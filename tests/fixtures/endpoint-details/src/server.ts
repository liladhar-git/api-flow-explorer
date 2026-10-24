import express from 'express';
const app = express();
const auth = (req: any, res: any, next: any) => next();

/** Lists every widget visible to the caller. */
function listWidgets(req: any, res: any) {
  res.json([]);
}

export const widgetController = {
  /** Create a widget. */
  create(req: any, res: any) {
    res.json({});
  },
};

app.get('/widgets', auth, listWidgets);
app.post('/widgets', widgetController.create);
