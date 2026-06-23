const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSupportBotReply, createSupportSession } = require('../utils/supportBot');

test('buildSupportBotReply returns a greeting with options', () => {
  const session = createSupportSession();
  const reply = buildSupportBotReply('hola', session);
  assert.match(reply, /NendoBot/i);
  assert.match(reply, /1\)/);
  assert.match(reply, /2\)/);
});

test('buildSupportBotReply can guide a purchase issue flow', () => {
  const session = createSupportSession();
  buildSupportBotReply('hola', session);
  const reply = buildSupportBotReply('1', session);
  assert.match(reply, /pedido/i);
  assert.match(reply, /número de pedido/i);
});
