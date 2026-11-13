/** The one Not found page for any request id the viewer may not see, or that does not exist. */
export function NotFound() {
  return (
    <div className="page page--narrow not-found">
      <h1>Request not found</h1>
      <p>This request doesn't exist or isn't available to you.</p>
    </div>
  );
}
