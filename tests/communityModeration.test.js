const assert = require('assert');
const { moderateCommunityMessage } = require('../utils/supportBot');

(async () => {
  const safe = await moderateCommunityMessage('Me gusta esta comunidad, gracias por la ayuda.');
  assert.strictEqual(safe.allowed, true);
  assert.strictEqual(safe.block, false);

  const blocked = await moderateCommunityMessage('Esto es una amenaza y un insulto claro.');
  assert.strictEqual(blocked.block, true);
  assert.strictEqual(blocked.allowed, false);

  console.log('community moderation tests passed');
})();
