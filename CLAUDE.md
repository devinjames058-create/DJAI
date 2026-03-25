# DJAI Finance Intelligence

## Project
Bloomberg-style AI financial research terminal at djai.vercel.app

## Stack
- index.html — full frontend (single file, ~1950 lines)
- api/proxy.js — Anthropic API proxy (routes Claude calls server-side)
- api/data.js — live market data (Yahoo Finance + Alpha Vantage + FRED)
- api/macro.js — macro indicators (VIX, DXY, WTI, 10Y Treasury, CPI)
- api/filings.js — SEC EDGAR filing fetcher
- vercel.json — function timeout config

## Keys (stored in Vercel env vars, never in code)
- ANTHROPIC_API_KEY — Claude API
- RAPIDAPI_KEY — Yahoo Finance via RapidAPI
- ALPHA_VANTAGE_KEY — ID1Z4HRQYF23ZTYP

## Deploy workflow
After any changes: git add . && git commit -m "description" && git push
Vercel auto-deploys from GitHub main branch within 30 seconds.
Live URL: https://djai.vercel.app

## Current issues to fix
- api/macro.js — Yahoo Finance symbols returning null (^VIX, DX-Y.NYB, CL=F, ^TNX)
- index.html — results header buttons stacking vertically instead of horizontal row
