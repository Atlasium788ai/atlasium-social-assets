import { integrationReadiness } from "../lib/integration-readiness";

// Reports only configuration state and missing variable names. Secret values are never printed.
console.log(JSON.stringify(integrationReadiness(process.env), null, 2));
