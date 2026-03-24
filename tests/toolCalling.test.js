import test from 'node:test';
import assert from 'node:assert/strict';
import apiClient from '../src/utils/apiClient.js';
import config from '../src/config.js';

test('generateWithTools method exists on API client', async () => {
  assert.ok(apiClient);
  assert.strictEqual(typeof apiClient.generateWithTools, 'function');
});

test('Basic tool calling functionality', async (t) => {
  // Skip test if no API keys configured
  if (!config.openai?.textModel?.apiKey || config.apiProvider !== 'openai') {
    t.skip('Skipping tool calling test: OpenAI provider not configured');
    return;
  }

  let toolCalled = false;
  let receivedArgs = null;

  const testTools = [
    {
      type: 'function',
      function: {
        name: 'get_current_weather',
        description: 'Get the current weather in a given location',
        parameters: {
          type: 'object',
          properties: {
            location: {
              type: 'string',
              description: 'The city and state, e.g. San Francisco, CA',
            },
            unit: {
              type: 'string',
              enum: ['celsius', 'fahrenheit'],
            },
          },
          required: ['location'],
        },
      },
    },
  ];

  const toolHandlers = {
    get_current_weather: async (args) => {
      toolCalled = true;
      receivedArgs = args;
      return {
        location: args.location,
        temperature: 22,
        unit: args.unit || 'celsius',
        forecast: ['sunny', 'windy'],
      };
    },
  };

  const systemPrompt = 'You are a helpful assistant. You MUST use the provided get_current_weather tool to answer questions about weather. Do not make up weather information. Always call the tool first when asked about weather.';
  const userPrompt = "What's the weather like in Paris today? Use the get_current_weather tool to get this information.";

  const result = await apiClient.generateWithToolsLegacy(userPrompt, systemPrompt, testTools, {
    toolHandlers,
    maxTurns: 3,
    temperature: 0,
    toolChoice: 'auto',
  });

  // Handle new return format { content, messages }
  const response = result.content || result;

  assert.ok(toolCalled, 'Tool should have been called');
  assert.ok(receivedArgs, 'Tool should have received arguments');
  assert.ok(receivedArgs.location.toLowerCase().includes('paris'), 'Tool should receive Paris as location');
  assert.ok(response, 'Should receive final response from LLM');
  assert.ok(response.toLowerCase().includes('22') || response.toLowerCase().includes('sunny'), 
    'Response should include weather data from tool');
});

test('Multiple tool calls handling', async (t) => {
  // Skip test if no API keys configured
  if (!config.openai?.textModel?.apiKey || config.apiProvider !== 'openai') {
    t.skip('Skipping multiple tool calls test: OpenAI provider not configured');
    return;
  }

  const callCounts = {
    get_user_info: 0,
    get_user_orders: 0,
  };

  const testTools = [
    {
      type: 'function',
      function: {
        name: 'get_user_info',
        description: 'Get basic information about a user',
        parameters: {
          type: 'object',
          properties: {
            user_id: { type: 'string', description: 'The ID of the user' },
          },
          required: ['user_id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'get_user_orders',
        description: 'Get order history for a user',
        parameters: {
          type: 'object',
          properties: {
            user_id: { type: 'string', description: 'The ID of the user' },
            limit: { type: 'number', description: 'Maximum number of orders to return' },
          },
          required: ['user_id'],
        },
      },
    },
  ];

  const toolHandlers = {
    get_user_info: async (args) => {
      callCounts.get_user_info++;
      return {
        user_id: args.user_id,
        name: 'John Doe',
        email: 'john@example.com',
        join_date: '2023-01-15',
      };
    },
    get_user_orders: async (args) => {
      callCounts.get_user_orders++;
      return {
        user_id: args.user_id,
        orders: [
          { id: 'ord_1', total: 99.99, date: '2024-03-01', status: 'delivered' },
          { id: 'ord_2', total: 49.99, date: '2024-03-10', status: 'shipped' },
        ],
      };
    },
  };

  const systemPrompt = 'You are a helpful customer support assistant. You MUST use the provided tools to answer user questions accurately. Do not answer from your own knowledge.';
  const userPrompt = "Tell me about user 12345 and their recent orders. Limit orders to 2. Use the available tools to get this information.";

  const result = await apiClient.generateWithToolsLegacy(userPrompt, systemPrompt, testTools, {
    toolHandlers,
    maxTurns: 4,
    temperature: 0,
    toolChoice: 'auto',
  });

  // Handle new return format { content, messages }
  const response = result.content || result;

  assert.strictEqual(callCounts.get_user_info, 1, 'get_user_info should be called once');
  assert.strictEqual(callCounts.get_user_orders, 1, 'get_user_orders should be called once');
  assert.ok(response, 'Should receive final response');
  assert.ok(response.includes('John Doe') && response.includes('ord_1'), 
    'Response should include both user info and order data');
});

test('Unknown tool handling', async (t) => {
  // Skip test if no API keys configured
  if (!config.openai?.textModel?.apiKey || config.apiProvider !== 'openai') {
    t.skip('Skipping unknown tool test: OpenAI provider not configured');
    return;
  }

  const testTools = [
    {
      type: 'function',
      function: {
        name: 'unknown_tool',
        description: 'A tool that does not have a handler',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];

  // No tool handlers provided
  const result = await apiClient.generateWithToolsLegacy(
    'Call the unknown_tool function',
    'You are a helpful assistant that uses the provided tools',
    testTools,
    { maxTurns: 2, temperature: 0 }
  );

  // Handle new return format { content, messages }
  const response = result.content || result;

  assert.ok(response, 'Should return response even for unknown tool');
});

test('Tool calling error handling', async (t) => {
  // Skip test if no API keys configured
  if (!config.openai?.textModel?.apiKey || config.apiProvider !== 'openai') {
    t.skip('Skipping tool error handling test: OpenAI provider not configured');
    return;
  }

  let errorCaught = false;

  const testTools = [
    {
      type: 'function',
      function: {
        name: 'failing_tool',
        description: 'A tool that always throws an error',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];

  const toolHandlers = {
    failing_tool: async () => {
      throw new Error('Internal server error: database connection failed');
    },
  };

  const result = await apiClient.generateWithToolsLegacy(
    'Call the failing_tool function',
    'You are a helpful assistant',
    testTools,
    { toolHandlers, maxTurns: 2, temperature: 0 }
  );

  // Handle new return format { content, messages }
  const response = result.content || result;

  assert.ok(response, 'Should return response even when tool throws error');
  assert.ok(
    response.toLowerCase().includes('error') || response.toLowerCase().includes('failed'),
    'Response should indicate tool failure'
  );
});
