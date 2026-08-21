const response = await fetch(process.env.APP_BASE_URL ?? "http://localhost:3000/api/health");
if (!response.ok) process.exit(1);
console.log("healthy");
