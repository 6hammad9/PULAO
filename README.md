# PULAO

Event-first access operations for temporary venues.

PULAO lets an operator create an event, register people for that event, assign allowed checkpoints, and review live access decisions from fixed cameras or mobile browser checkpoints.

## Structure

- `pulao/` - React frontend
- `pulao_backend/` - Node/Express API
- `pulao_vision/` - Python vision service

## Local Setup

Create local env files from the examples:

```bash
cp pulao/.env.example pulao/.env
cp pulao_backend/.env.example pulao_backend/.env
cp pulao_vision/.env.example pulao_vision/.env
```

Install and run the frontend:

```bash
cd pulao
npm install
npm run dev
```

Install and run the backend:

```bash
cd pulao_backend
npm install
npm run dev
```

Run the vision service:

```powershell
cd pulao_vision
.\start_vision_service.ps1
```

## Privacy

Runtime files are intentionally ignored: `.env`, uploads, detections, event evidence, logs, embeddings, and generated metadata do not belong in Git.
