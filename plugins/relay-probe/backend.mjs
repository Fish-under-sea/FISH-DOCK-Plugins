import { createPlugin } from './sdk.mjs';
import { createRelayService } from './service.mjs';

let service;

createPlugin({
  id: 'fish.relay-probe',
  activate: async context => {
    service = createRelayService({ context });
    await service.load();
  },
  deactivate: async () => {
    if (service) await service.stop();
    service = null;
  },
  commands: {
    'relay.view': () => service.view(),
    'relay.save': params => service.save(params),
    'relay.start': params => service.start(params),
    'relay.status': () => service.status(),
    'relay.stop': () => service.stop(),
  },
});
