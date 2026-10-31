import { createApp } from './app.ts';
import { createBookingService } from './booking.ts';
import { now } from './clock.ts';
import { bookingRepo, masters, services } from './store.ts';

const port = Number(process.env.PORT ?? 3002);

const booking = createBookingService({ masters, services, repo: bookingRepo, now });

createApp(booking, masters, services).listen(port, () => {
  console.log(`booking: http://localhost:${port}`);
});
