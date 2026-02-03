// Quick test script for the backend
const testCode = `let main = () => {
  42
};`;

const response = await fetch('http://localhost:3001/api/compile', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ source: testCode, stage: 'all' }),
});

const result = await response.json();
console.log('Result:', JSON.stringify(result, null, 2));
