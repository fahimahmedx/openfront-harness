https://openfront.io/
The game's source code has been pulled to the @OpenFrontIO repo, tag v0.32.9

Create a simple harness for Openfront, where an LLM can play Openfront and the user is able to see a full replay of it play. Only play on the Japan map. .env already has OPENROUTER_API_KEY

The goal is to create a harness project for my portfolio to get me hired and create a writeup that explains what I learned (writeup.md) that I will post online. Every design decision (with the pros & cons of each decision) MUST be documented in a design-decision.md doc.

Map: Japan
Players: 1 LLM + 3 built-in nation bots set to medium difficulty.
Spawn: 1 fixed location
Seeds: 1 fixed seeds
Decision interval: fixed
Actions per decision: fixed

The reason we have fixed seeds, is because we eventually want to create a benchmark from this harness, where there is a leaderboard.

This app will be deployed to Railway.
