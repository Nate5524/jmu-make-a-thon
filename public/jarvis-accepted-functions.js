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
  {
    type: 'function',
    function: {
      name: 'create_schedule',
      description:
        'Schedule a future message or action. Use mode "static" for a fixed reminder (storedAssistantText is shown verbatim). Use mode "llm_followup" when you need live context at trigger time (e.g. daily calendar briefing): provide storedInstruction describing what to do, plus optional toolSteps to run first. Allowed toolSteps names: create_calendar_event, delete_calendar_event, edit_calendar_event, set_demo_smart_home_device, spotify_play, spotify_pause, spotify_skip_next, spotify_skip_previous, spotify_play_track, spotify_queue_track.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['static', 'llm_followup'], description: '"static" = fixed text, "llm_followup" = tools + LLM compose' },
          label: { type: 'string', description: 'Short summary shown in the schedule list' },
          date: { type: 'string', description: 'YYYY-MM-DD for the first run (user local date)' },
          time: { type: 'string', description: 'HH:MM (24h) for the run time (user local time)' },
          delayMinutes: { type: 'number', description: 'Alternative to date/time: fire N minutes from now' },
          repeat: { type: 'string', enum: ['once', 'daily', 'weekly'], description: 'Default once' },
          weekday: { type: 'number', description: '0=Sun..6=Sat, required for weekly repeat' },
          storedAssistantText: { type: 'string', description: 'For static mode: exact text shown to user' },
          storedInstruction: { type: 'string', description: 'For llm_followup mode: natural language instruction for the LLM at trigger time' },
          toolSteps: {
            type: 'array',
            description: 'For llm_followup: tools to execute before composing the response',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Tool function name' },
                args: { type: 'object', description: 'Tool arguments' },
              },
              required: ['name'],
            },
          },
          speak: { type: 'boolean', description: 'Whether to speak aloud (default true)' },
        },
        required: ['mode', 'label'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_schedule',
      description: 'Cancel/delete a scheduled item by its id (shown in live context as [sched:ID]).',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Schedule id to cancel' },
        },
        required: ['id'],
      },
    },
  },
];
