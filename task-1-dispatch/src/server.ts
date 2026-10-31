import { createApp } from './app.ts';
import { createDispatch } from './dispatch.ts';
import { branches, orders } from './store.ts';

const port = Number(process.env.PORT ?? 3001);

createApp(createDispatch(branches, orders), branches).listen(port, () => {
  console.log(`dispatch: http://localhost:${port}`);
});
