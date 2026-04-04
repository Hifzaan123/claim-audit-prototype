const fs = require("fs");
const path = require("path");

const { parsePolicyClauses } = require("./backend/services/policyParser");
const { extractClaimFields } = require("./backend/services/claimExtractor");
const { decideClaim } = require("./backend/services/ruleEngine");

const policyText = fs.readFileSync("./backend/data/sample-policy.txt", "utf-8");
const claimText = fs.readFileSync("./backend/data/sample-claim.txt", "utf-8");

const policy = parsePolicyClauses(policyText);
const claim = extractClaimFields(claimText);
const result = decideClaim(claim, policy);

console.log("FINAL RESULT:\n", result);