# PULAO • AI-powered temporary access control

> **Most events still run on clipboards and eyeballs.  
> PULAO turns any camera or authorized phone into an instant AI checkpoint.**

[![Build status](https://github.com/your-org/pulao/actions/workflows/ci.yml/badge.svg)](…)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](/LICENSE)

---

### ✨ What it does  
* Create **zones** (Main Gate, VIP, Staff-only)  
* Upload or snap guest photos → mark them *Allowed*, *VIP*, or *Blocked*  
* Point a phone or camera; PULAO decides in real time  

<img src="docs/demo.gif" width="720" />

### 🚀 Quick start

```bash
git clone https://github.com/your-org/pulao.git
cd pulao
docker compose up      # backend + DB
npm install && npm run dev   # frontend
