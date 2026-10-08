// A subprocess fixture, never an Orca command or live terminal target.
console.log(JSON.stringify({ ok: true, result: { args: process.argv.slice(2) } }))
