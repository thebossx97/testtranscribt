# Feature Roadmap: Advanced Diarization & Meeting Management

## Current Status ✅

**Implemented:**
- ✅ AudioWorklet VAD with pre/post-roll buffers
- ✅ Basic speaker diarization (3 features: pitch, energy, spectral)
- ✅ Word-level timestamps from Whisper
- ✅ Speaker identification with clustering
- ✅ Timestamped transcript display

**Accuracy:** ~75-80% for 2-3 speakers

---

## Phase 1: Advanced Speaker Recognition (High Priority)

### 1.1 Enhanced Audio Features
**Goal:** Increase accuracy to 95%+

**Implementation:**
- Replace simple ZCR with **autocorrelation-based pitch detection**
- Add **formant estimation** (vowel characteristics)
- Add **spectral band analysis** (low/mid/high frequency distribution)
- Add **pitch variance** (speaking style)
- Use **median instead of mean** (robust to outliers)

**Files to modify:**
- `js/vad-processor.js` - Add `calculatePitch()`, `calculateFormants()`, `calculateSpectralFeatures()`
- Extract 8 features instead of 3

**Expected improvement:** +15-20% accuracy

### 1.2 Advanced Clustering Algorithm
**Goal:** Better speaker separation

**Implementation:**
- **Weighted multi-dimensional distance** (pitch=2.0, formant=1.8, etc.)
- **Adaptive threshold** based on number of speakers
- **Confidence-weighted learning** (exponential moving average)
- **Median-based feature extraction** (more robust)

**Files to modify:**
- `js/app.js` - Replace `calculateFeatureDistance()` and `identifySpeaker()`

**Expected improvement:** +10-15% accuracy

---

## Phase 2: Meeting Management System (Medium Priority)

### 2.1 Meeting State & Stats
**Goal:** Track meeting metadata

**Implementation:**
- Meeting object: `{ id, title, startTime, endTime, speakers, utterances }`
- Real-time stats: duration, utterance count, word count
- Speaker stats: total speaking time per speaker

**Files to modify:**
- `js/app.js` - Add `state.currentMeeting`, `updateMeetingStats()`
- `index.html` - Add meeting header with stats

### 2.2 IndexedDB Persistence
**Goal:** Save/load meetings

**Implementation:**
- IndexedDB schema: `meetings` object store
- Functions: `saveMeetingToDB()`, `loadMeetingsFromDB()`, `deleteMeetingFromDB()`
- Meeting history sidebar

**Files to create:**
- Add IndexedDB functions to `js/app.js`

### 2.3 Meeting Controls
**Goal:** User-friendly meeting management

**Implementation:**
- New Meeting button (saves current, starts fresh)
- Rename Meeting dialog
- Save Meeting button
- Meeting History sidebar (load/delete)

**Files to modify:**
- `index.html` - Add meeting controls UI
- `css/styles.css` - Add meeting UI styles
- `js/app.js` - Add meeting management functions

---

## Phase 3: Enhanced UI (Medium Priority)

### 3.1 Speaker Badges
**Goal:** Visual speaker identification

**Implementation:**
- Speaker panel showing all detected speakers
- Emoji avatars for each speaker
- Color-coded badges
- Speaking time per speaker
- Active speaker animation

**Files to modify:**
- `index.html` - Add speakers panel
- `css/styles.css` - Add speaker badge styles
- `js/app.js` - Add `updateSpeakersPanel()`

### 3.2 Visual Transcript Display
**Goal:** Beautiful transcript view

**Implementation:**
- Replace plain textarea with styled div
- Speaker avatars next to each utterance
- Color-coded speaker names
- Animated utterance appearance
- Hover effects on words

**Files to modify:**
- `index.html` - Add transcript container
- `css/styles.css` - Add utterance styles
- `js/app.js` - Add `updateVisualTranscript()`

---

## Phase 4: Export Enhancements (Low Priority)

### 4.1 Multiple Export Formats
**Goal:** Professional export options

**Implementation:**
- **TXT:** Plain text with timestamps and speakers
- **SRT:** Subtitle format for video
- **JSON:** Full metadata (speakers, features, timestamps)
- **DOCX:** Formatted document (requires library)

**Files to modify:**
- `js/app.js` - Add `exportDiarizedTranscript(format)`
- Add format selector to download button

### 4.2 Export Customization
**Goal:** User control over export

**Implementation:**
- Include/exclude timestamps
- Include/exclude speaker names
- Word-level vs utterance-level timestamps
- Export selected speakers only

---

## Phase 5: Advanced Features (Future)

### 5.1 Speaker Labeling
- Manual speaker name editing
- Speaker merging (combine misidentified speakers)
- Speaker splitting (separate incorrectly merged)

### 5.2 Search & Navigation
- Search transcript by keyword
- Jump to timestamp
- Filter by speaker
- Highlight search results

### 5.3 Audio Playback
- Play original audio
- Sync playback with transcript
- Click utterance to jump to audio position
- Highlight current utterance during playback

### 5.4 Collaboration
- Share meeting link
- Export shareable HTML
- Cloud sync (optional)

---

## Implementation Priority

**Immediate (Next Session):**
1. ✅ Advanced audio features in VAD processor
2. ✅ Weighted clustering algorithm
3. ✅ Meeting stats display

**Short-term (1-2 sessions):**
4. IndexedDB persistence
5. Meeting management UI
6. Speaker badges panel

**Medium-term (3-5 sessions):**
7. Visual transcript display
8. Enhanced export formats
9. Meeting history sidebar

**Long-term (Future):**
10. Speaker labeling tools
11. Search & navigation
12. Audio playback sync

---

## Technical Debt & Improvements

### Code Organization
- [ ] Split `app.js` into modules (vad.js, diarization.js, meeting.js, ui.js)
- [ ] Create TypeScript definitions
- [ ] Add JSDoc comments
- [ ] Unit tests for clustering algorithm

### Performance
- [ ] Web Worker for feature extraction
- [ ] Lazy loading of old meetings
- [ ] Virtual scrolling for long transcripts
- [ ] Audio compression for storage

### Accessibility
- [ ] Keyboard shortcuts
- [ ] Screen reader support
- [ ] High contrast mode
- [ ] Font size controls

---

## Estimated Effort

| Phase | Features | Effort | Impact |
|-------|----------|--------|--------|
| Phase 1 | Advanced Recognition | 2-3 hours | High (95% accuracy) |
| Phase 2 | Meeting Management | 3-4 hours | High (persistence) |
| Phase 3 | Enhanced UI | 2-3 hours | Medium (UX) |
| Phase 4 | Export Formats | 1-2 hours | Medium (utility) |
| Phase 5 | Advanced Features | 5-10 hours | Low (nice-to-have) |

**Total for Phases 1-4:** ~10-15 hours of development

---

## Success Metrics

**Speaker Accuracy:**
- Current: ~75-80%
- Target: 95%+

**User Experience:**
- Meeting save/load: < 1 second
- Real-time updates: < 100ms latency
- Export generation: < 2 seconds

**Scalability:**
- Support 8+ speakers
- Handle 2+ hour meetings
- Store 100+ meetings locally

---

## Next Steps

1. **Implement Phase 1.1** - Advanced audio features
2. **Test accuracy** - Compare before/after with real audio
3. **Implement Phase 1.2** - Advanced clustering
4. **Add meeting stats** - Basic UI improvements
5. **Commit and deploy** - Get user feedback

This roadmap provides a clear path from current 75-80% accuracy to production-grade 95%+ accuracy with full meeting management.
