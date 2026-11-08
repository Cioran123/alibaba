export default function Home() {
  return (
    <main>
      <h1>Procurement Dept — agent sourcing for Chinese suppliers</h1>
      <ul>
        <li><a href="/ops">/ops</a> — internal pipeline view</li>
        <li><code>GET /api/pipeline</code>, <code>GET /api/suppliers/:id</code>, <code>GET /api/memos</code>, <code>POST /api/approve</code></li>
        <li><code>/api/mcp</code> — procurement-ops MCP server (bearer)</li>
      </ul>
    </main>
  );
}
