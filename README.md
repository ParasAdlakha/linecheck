# LineCheck

An AI inspector an aircraft technician calls on FaceTime. The technician points the phone at a part and talks. LineCheck:

1. **looks** at the part (live FaceTime video, or a photo sent from the `/snap` page) with a vision model
2. **finds the procedure** in maintenance references (FAA AC 43.13-1B, AMT handbooks)
3. **checks known failures** in FAA Service Difficulty Reports for the same aircraft and part
4. **searches Airworthiness Directives** through Keenable (Federal Register first)
5. **drafts the work order** on a live board, where a certificated technician signs it

LineCheck assists and documents. It never declares a part airworthy.

Modalities: live video · voice in/out · PDF documents · web search · structured record.

## Layout

```
agent/    LiveKit agent Chert puts on FaceTime (agent.mjs), its tools (tools.mjs), the reticle picture (scope.mjs)
core/     procedure search (BM25), SDR lookup, Keenable AD search, vision, work-order model, PNG encoder
board/    live work-order board (/) and phone photo page (/snap)
scripts/  ingest.mjs builds indexes from data/raw; ask.mjs runs tools from the terminal
data/     sample/ ships clearly labelled sample data; raw/ and index/ are yours (gitignored)
```

## Run it

Needs Node 22.23+ or 24. **The Chert CLI runs only on macOS or Linux.** On Windows, run `chert` (and ideally the agent) inside WSL.

```sh
npm install
cp .env.example .env.local          # fill in LiveKit, OpenAI, Keenable, AGENT_NAME
npm test                            # 10 unit tests, no keys needed
```

Three terminals:

```sh
npm run board                       # 1: work-order board on http://localhost:8787
npm run agent:dev                   # 2: the LiveKit agent
chert login && chert dev --agent linecheck-adlakha --minutes 30   # 3: put it on the FaceTime line
```

Then make a **FaceTime Video** call to the line `chert dev` prints. Put the board on the projector.

Set `BOARD_URL` to your laptop's LAN address (for example `http://192.168.1.20:8787`) so the phone can open `/snap` on the same Wi-Fi.

## Real data (replaces the sample)

FAA.gov blocks scripted downloads, so get these in a browser and drop them in `data/raw/`:

- AC 43.13-1B PDF: faa.gov → Advisory Circulars → AC 43.13-1B
- AMT Airframe Handbook PDFs (optional): faa.gov → Handbooks & Manuals → Aviation Maintenance Technician
- SDR CSV for one or two recent years: faa.gov/av-info/download_SDR

```sh
npm run ingest
npm run ask -- procedure "corrosion around rivets on wing skin"
npm run ask -- failures "Cessna 172" "skin corrosion"
npm run ask -- ads "Cessna 172" "wing attach fitting"
npm run ask -- look photo.jpg "lower wing skin near rivet line"
```

Until you ingest, tool results carry `sample_data: true` and the agent says so on the call.

## Demo script (3 minutes)

1. Call the line. "Tail November 7-3-4 Alpha Delta, Cessna 172."
2. Hold up the prop (printed photo of rivet corrosion). "Take a look at this rivet line."
3. LineCheck describes the finding; the photo and finding appear on the board.
4. "What's the procedure?" → AC 43.13-1B citation on the board.
5. "Any history or ADs on this?" → SDR tally and AD links appear.
6. "Draft it." → discrepancy and proposed action appear. Sign it on the board.

## Known risks

- Chert documents its bridge as tested with audio, and its starter does not read the caller's camera. If no caller video arrives, `look` falls back to the `/snap` photo. Ask Chert on-site whether the FaceTime bridge publishes caller video.
- `VISION_MODEL` defaults to `gpt-5-mini`. Change it if your key lacks access.
