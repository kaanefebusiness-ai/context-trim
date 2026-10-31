import { createRequestListener } from '../src/http.js';

// Vercel entry point for the remote MCP server. Every path is rewritten here
// (see vercel.json); NODEJS_HELPERS=0 keeps the raw request stream intact.
export default createRequestListener();
