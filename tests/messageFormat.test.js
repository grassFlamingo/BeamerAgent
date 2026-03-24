import test from 'node:test';
import assert from 'node:assert/strict';
import { MessageBuilder, ConversationManager, ChatSession } from '../utils/apiClient.js';

test('MessageBuilder.user - string content', () => {
  const msg = MessageBuilder.user('Hello, world!');
  assert.strictEqual(msg.role, 'user');
  assert.strictEqual(msg.content, 'Hello, world!');
});

test('MessageBuilder.system', () => {
  const msg = MessageBuilder.system('You are a helpful assistant.');
  assert.strictEqual(msg.role, 'system');
  assert.strictEqual(msg.content, 'You are a helpful assistant.');
});

test('MessageBuilder.assistant - plain content', () => {
  const msg = MessageBuilder.assistant('This is a response.');
  assert.strictEqual(msg.role, 'assistant');
  assert.strictEqual(msg.content, 'This is a response.');
  assert.strictEqual(msg.tool_calls, undefined);
});

test('MessageBuilder.assistant - with tool calls', () => {
  const toolCalls = [{ id: 'call_123', type: 'function', function: { name: 'test', arguments: '{}' } }];
  const msg = MessageBuilder.assistant('Using tool...', toolCalls);
  assert.strictEqual(msg.role, 'assistant');
  assert.strictEqual(msg.content, 'Using tool...');
  assert.deepStrictEqual(msg.tool_calls, toolCalls);
});

test('MessageBuilder.tool', () => {
  const content = { result: 'success' };
  const msg = MessageBuilder.tool('call_123', content);
  assert.strictEqual(msg.role, 'tool');
  assert.strictEqual(msg.tool_call_id, 'call_123');
  assert.strictEqual(typeof msg.content, 'string');
});

test('MessageBuilder.textContent', () => {
  const content = MessageBuilder.textContent('Plain text');
  assert.deepStrictEqual(content, { type: 'text', text: 'Plain text' });
});

test('MessageBuilder.imageContent', () => {
  const content = MessageBuilder.imageContent('base64data123', 'image/png');
  assert.deepStrictEqual(content, {
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/png',
      data: 'base64data123'
    }
  });
});

test('ConversationManager - initialization with system prompt', () => {
  const manager = new ConversationManager('You are a helpful assistant.');
  const messages = manager.getMessages();
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].role, 'system');
  assert.strictEqual(messages[0].content, 'You are a helpful assistant.');
});

test('ConversationManager - initialization without system prompt', () => {
  const manager = new ConversationManager();
  const messages = manager.getMessages();
  assert.strictEqual(messages.length, 0);
});

test('ConversationManager - addUserMessage', () => {
  const manager = new ConversationManager();
  manager.addUserMessage('Hello!');
  const messages = manager.getMessages();
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].role, 'user');
  assert.strictEqual(messages[0].content, 'Hello!');
});

test('ConversationManager - addAssistantMessage', () => {
  const manager = new ConversationManager();
  manager.addUserMessage('Hello!');
  manager.addAssistantMessage('Hi there!');
  const messages = manager.getMessages();
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[1].role, 'assistant');
  assert.strictEqual(messages[1].content, 'Hi there!');
});

test('ConversationManager - addToolMessage', () => {
  const manager = new ConversationManager();
  manager.addToolMessage('call_123', { result: 'success' });
  const messages = manager.getMessages();
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].role, 'tool');
  assert.strictEqual(messages[0].tool_call_id, 'call_123');
});

test('ConversationManager - setSystemPrompt', () => {
  const manager = new ConversationManager();
  manager.addUserMessage('Hello!');
  manager.setSystemPrompt('New system prompt');
  const messages = manager.getMessages();
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].role, 'system');
  assert.strictEqual(messages[0].content, 'New system prompt');
});

test('ConversationManager - getLastUserMessage', () => {
  const manager = new ConversationManager();
  manager.addUserMessage('First');
  manager.addAssistantMessage('Response');
  manager.addUserMessage('Second');
  const lastUser = manager.getLastUserMessage();
  assert.strictEqual(lastUser.content, 'Second');
});

test('ConversationManager - getLastAssistantMessage', () => {
  const manager = new ConversationManager();
  manager.addUserMessage('First');
  manager.addAssistantMessage('First Response');
  manager.addUserMessage('Second');
  const lastAssistant = manager.getLastAssistantMessage();
  assert.strictEqual(lastAssistant.content, 'First Response');
});

test('ConversationManager - getTurnCount', () => {
  const manager = new ConversationManager();
  assert.strictEqual(manager.getTurnCount(), 0);
  manager.addUserMessage('Hello');
  manager.addAssistantMessage('Hi');
  assert.strictEqual(manager.getTurnCount(), 1);
  manager.addUserMessage('How are you?');
  manager.addAssistantMessage('Fine');
  assert.strictEqual(manager.getTurnCount(), 2);
});

test('ConversationManager - clear', () => {
  const manager = new ConversationManager('System');
  manager.addUserMessage('Hello');
  manager.addAssistantMessage('Hi');
  manager.clear();
  const messages = manager.getMessages();
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].role, 'system');
});

test('ConversationManager - clone', () => {
  const manager = new ConversationManager('System');
  manager.addUserMessage('Hello');
  const cloned = manager.clone();
  cloned.addAssistantMessage('Hi');
  assert.strictEqual(manager.getMessages().length, 2);
  assert.strictEqual(cloned.getMessages().length, 3);
});

test('ConversationManager - fromMessages', () => {
  const messages = [
    { role: 'system', content: 'System' },
    { role: 'user', content: 'Hello' }
  ];
  const manager = ConversationManager.fromMessages(messages);
  assert.strictEqual(manager.getMessages().length, 2);
});

test('ConversationManager - toString', () => {
  const manager = new ConversationManager();
  manager.addUserMessage('Hello');
  const str = manager.toString();
  assert.strictEqual(typeof str, 'string');
  assert.ok(str.includes('Hello'));
});

test('APIClient.createConversationManager', async () => {
  const apiClient = (await import('../utils/apiClient.js')).default;
  const manager = apiClient.createConversationManager('System prompt');
  assert.ok(manager instanceof ConversationManager);
  assert.strictEqual(manager.getMessages().length, 1);
});

test('ChatSession - initialization with system prompt', () => {
  const session = new ChatSession('You are a helpful assistant.');
  assert.strictEqual(session.history.length, 1);
  assert.strictEqual(session.turns, 0);
});

test('ChatSession - initialization with tools', () => {
  const tools = [
    { type: 'function', function: { name: 'test', description: '', parameters: {} } }
  ];
  const session = new ChatSession('You are a helper.', tools, { model: 'gpt-4o' });
  assert.strictEqual(session.history.length, 1);
});

test('ChatSession - onTool', () => {
  const session = new ChatSession('You are a helper.');
  session.onTool('get_weather', async ({ location }) => ({ temp: 20 }));
  assert.strictEqual(Object.keys(session._toolHandlers).length, 1);
});

test('ChatSession - history getter', () => {
  const session = new ChatSession('System');
  session.conversation.addUserMessage('Hello');
  session.conversation.addAssistantMessage('Hi there!');
  
  const history = session.history;
  assert.strictEqual(history.length, 3);
  assert.strictEqual(history[0].role, 'system');
  assert.strictEqual(history[1].role, 'user');
  assert.strictEqual(history[2].role, 'assistant');
});

test('ChatSession - turns getter', () => {
  const session = new ChatSession('System');
  assert.strictEqual(session.turns, 0);
  session.conversation.addUserMessage('Hello');
  session.conversation.addAssistantMessage('Hi');
  assert.strictEqual(session.turns, 1);
});

test('ChatSession - clear', () => {
  const session = new ChatSession('System');
  session.conversation.addUserMessage('Hello');
  session.conversation.addAssistantMessage('Hi');
  
  session.clear();
  
  assert.strictEqual(session.history.length, 1);
  assert.strictEqual(session.history[0].role, 'system');
});

test('ChatSession - reset', () => {
  const session = new ChatSession('System');
  session.conversation.addUserMessage('Hello');
  session.conversation.addAssistantMessage('Hi');
  
  session.reset();
  
  assert.strictEqual(session.history.length, 1);
  assert.strictEqual(session.turns, 0);
});

test('ChatSession.from - factory function', () => {
  const tools = [
    { type: 'function', function: { name: 'test', description: '', parameters: {} } }
  ];
  const createSession = ChatSession.from(tools, { model: 'gpt-4o' });
  const session = createSession('You are a helper.');
  
  assert.strictEqual(session.history.length, 1);
});
