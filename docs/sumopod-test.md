# SumoPod Test

Set the model centrally in the backend environment before starting the server:

```env
SUMO_MODEL=<model-name>
```

## Endpoint

- `GET /api/sumopod/health`
- `POST /api/sumopod/test`

## cURL

```bash
curl -X POST http://localhost:3000/api/sumopod/test \
  -H "Content-Type: application/json" \
  -d "{\"prompt\":\"Say hello in a creative way\",\"maxTokens\":150,\"temperature\":0.5,\"systemPrompt\":\"You are a helpful assistant that answers clearly and concisely in Bahasa Indonesia.\"}"
```

## Postman

Import file:

- `docs/sumopod-test.postman_collection.json`

Then set `baseUrl` sesuai host API kamu, misalnya:

- `http://localhost:3000`
