/**
 * Puter.ai.chat() tool definitions for Jarvis calendar actions.
 * Loaded as a classic script before jarvis.html inline code (sets global JARVIS_TOOLS).
 */
var JARVIS_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'create_calendar_event',
      description:
        'Create a Google Calendar event for the user. Use 24-hour times (HH:MM). For timed events, date + startTime + endTime are required. For all-day, set allDay true and use date (and optional endDate for multi-day).',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string', description: 'Event title' },
          date: { type: 'string', description: 'Start date YYYY-MM-DD' },
          allDay: { type: 'boolean', description: 'Whether the event lasts the whole day' },
          endDate: { type: 'string', description: 'Optional last day YYYY-MM-DD for multi-day all-day events' },
          startTime: { type: 'string', description: 'Start time HH:MM (24h), required for timed events' },
          endTime: { type: 'string', description: 'End time HH:MM (24h), required for timed events' },
          description: { type: 'string', description: 'Optional longer description' },
        },
        required: ['summary', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_calendar_event',
      description: 'Delete a calendar event by id. Use the id shown in live context (e.g. after [id:...]).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Calendar event id to delete' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'edit_calendar_event',
      description:
        'Update an existing calendar event. id is required. Only include fields that change. For all-day conversion use allDay true and date (optional endDate). For timed changes include date, startTime, endTime together.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Event id to edit' },
          summary: { type: 'string' },
          description: { type: 'string' },
          allDay: { type: 'boolean' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          endDate: { type: 'string', description: 'Optional YYYY-MM-DD for all-day range' },
          startTime: { type: 'string', description: 'HH:MM (24h)' },
          endTime: { type: 'string', description: 'HH:MM (24h)' },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_demo_smart_home_device',
      description:
        'Set the demo smart home devices shown in the sidebar. Device `ambient` is the ambient lights (on/off). Device `blinds`: on=true means blinds raised/up, on=false means lowered/down.',
      parameters: {
        type: 'object',
        properties: {
          device: {
            type: 'string',
            enum: ['ambient', 'blinds'],
            description: '`ambient` = lights; `blinds` = window blinds (on = up)',
          },
          on: { type: 'boolean', description: 'Target power/up state' },
        },
        required: ['device', 'on'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spotify_play',
      description: 'Start or resume Spotify playback on the user’s active device (same as pressing play in the UI).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spotify_pause',
      description: 'Pause Spotify playback.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spotify_skip_next',
      description: 'Skip to the next track in Spotify.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spotify_skip_previous',
      description: 'Go to the previous track in Spotify.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spotify_play_track',
      description:
        'Search Spotify for a track by title/artist (or lyrics the user sang) and immediately play the best match.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search string, e.g. song title and artist' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'spotify_queue_track',
      description: 'Search Spotify and add the best matching track to the playback queue (does not skip current song).',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search string, e.g. song title and artist' },
        },
        required: ['query'],
      },
    },
  },
];
