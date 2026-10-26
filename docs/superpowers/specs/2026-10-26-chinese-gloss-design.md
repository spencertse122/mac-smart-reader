# v0.4.0 — Simplified Chinese for vocabulary

The user asked for this in chat on 2026-10-26 and chose the "macOS built-in Oxford Chinese dictionary" route. It builds on `2026-10-20-vocabulary-design.md`.

## Why
The user is a Chinese reader building English vocabulary. When they look up a word, and when a word card is flipped in Review, they want a short Simplified Chinese equivalent next to the English definition. Everything stays offline.

Anti-goals:
- No network calls.
- No machine translation.
- No bundled word list.
- Don't break the English lookup when the Chinese dictionary is missing.
- Don't clutter the card with the long bilingual entry.

## 1. Source
macOS ships 牛津英汉汉英词典 / Oxford Chinese Dictionary (identifier `com.apple.dictionary.zh_CN-en.OCD`, package "Simplified Chinese - English.dictionary"). It is listed on every Mac but downloaded only after the user ticks it in Dictionary.app → Settings. Until then a lookup returns nothing.

The helper picks a specific dictionary through private but long-stable DictionaryServices functions:
- `DCSCopyAvailableDictionaries` → CFSet of DCSDictionary.
- `DCSDictionaryGetIdentifier` resolved with `dlsym`. If the symbol is missing → "unavailable", never a crash.
- `DCSCopyTextDefinition(dict, term, range)`.

### Real OCD output (macOS 15 runner, 2026-10-26)
```
serendipity | BrE ˌsɛrənˈdɪpɪti, AmE ˌsɛrənˈdɪpədi | noun formal ① uncountable (luck) 机缘凑巧 jīyuán còuqiǎo ② countable (unplanned event) 巧事 qiǎo shì
mitigate | BrE ˈmɪtɪɡeɪt, AmE ˈmɪdəˌɡeɪt | transitive verb 缓和 huǎnhé ‹suffering, anxiety, crisis›; 减轻 jiǎnqīng ‹punishment, effects, sentence›
ephemeral | BrE ɪˈfɛm(ə)rəl, ɛˈfɛm(ə)rəl, AmE əˈfɛm(ə)rəl | adjective ① figurative (short-lived) 短暂的 duǎnzàn de ‹pleasures, sunshine, season›② Botany, Zoology 短生的 duǎnshēng de ‹insects, animals, plants›
ubiquitous | BrE juːˈbɪkwɪtəs, AmE juˈbɪkwədəs | adjective 普遍存在的 pǔbiàn cúnzài de▸ ubiquitous presence 无所不在▸ a ubiquitous expression 随处可见的表达方式
epistemology | BrE ɪˌpɪstəˈmɒlədʒi, AmE əˌpɪstəˈmɑlədʒi, ɛˌpɪstəˈmɑlədʒi | noun uncountable 认识论 rènshilùn
hegemony | BrE hɪˈɡɛməni, hɪˈdʒɛməni, AmE həˈdʒɛməni, ˈhɛdʒəˌmoʊni | noun uncountable formal (leadership) 领导权 lǐngdǎoquán; (dominance) 支配权 zhīpèiquán▸ military hegemony 军事霸权
nonetheless | BrE ˌnʌnðəˈlɛs, AmE ˌnənðəˈlɛs | adverb = nevertheless
set | BrE sɛt, AmE sɛt | A. transitive verb past tense, past participle set ① (place, position) 放置 fàngzhì ‹object›; 安置 ānzhì ‹person›▸ his hat was set at a rakish angle 他歪戴着帽子▸ … ② (arrange, establish) 确定 quèdìng ‹time, venue, target, standard›; 树立 shùlì ‹fashion›▸ … ③ (adjust) 设定 shèdìng▸ … ④ (put in motion) 使开始 shǐ kāishǐ▸ … ⑤ (assign, arrange) 布置 bùzhì ‹task, job›; 出…的题目 chū… de tímù ‹test›▸ …
running → (the whole "run" entry) run | BrE rʌn, AmE rən | A. intransitive verb present participle running … ① (move quickly) 跑 pǎo▸ … ② (as sport or for exercise) 跑步 pǎobù ③ (compete in race) «athlete, dog, horse» 参加赛跑 cānjiā sàipǎo▸ …
ran → 蚺 rán → 蚺蛇            (pinyin match on a Chinese headword — must be rejected)
zeitgeist → (nothing)
```
The full captured samples are in `tests/fixtures/ocd-samples.txt`, which the unit tests read.

## 2. Helper (`native/dict-lookup.swift`)
- `dict-lookup <term>`: the English definition, from New Oxford American Dictionary (`com.apple.dictionary.NOAD`) when it can be found by identifier, otherwise the default dictionary as today. This keeps English parsing stable even after the user enables the Chinese dictionary, which might sort above NOAD.
- `dict-lookup --zh <term>`: the OCD definition text.
- Exit codes:
  - 0 = printed.
  - 1 = no entry.
  - 2 = bad usage.
  - 3 = OCD not usable: not found among available dictionaries, private symbol missing, or not downloaded. "Not downloaded" is detected as: the term has no entry AND the probe word `water` also has no entry.
- Release check (`release.yml`) gains a step. It downloads OCD on the runner from the asset URL in `/System/Library/AssetsV2/com_apple_MobileAsset_DictionaryServices_dictionaryOSX/*.xml`: the entry with `DictionaryIdentifier == com.apple.dictionary.zh_CN-en.OCD` and the highest `_CompatibilityVersion`, URL = `__BaseURL + __RelativePath`. It unzips `AssetData/*.dictionary` into `~/Library/Dictionaries`, then runs the packaged helper `--zh serendipity` and checks the output contains `机缘凑巧`. If the download itself fails, that is a warning, not a failure (network). If the download succeeds but the lookup fails, the build fails.

## 3. Main process
- `DictLookupResult` ok branch gains `zh: ZhResult`, where
  `ZhResult = { status: 'ok'; gloss: string; entry: string } | { status: 'not-found' } | { status: 'unavailable' }`.
- `DictionaryService.lookup(term)` does the English lookup as today. When English is ok, it runs `--zh` with the English headword (lower-cased unless the headword is capitalised). If that is not ok, it retries with the queried term.
- A result is accepted only when it parses as an English entry: the text starts with a Latin letter and contains ` | `. Anything else, such as `蚺 rán …`, counts as not-found.
- **Cross-reference:** if the gloss comes out empty and the body is just `= <word>` (e.g. `adverb = nevertheless`), the service follows it once.
- Results are cached like English results. Stub (`SR_DICT_STUB`): key `zh:<term>` → raw OCD text; `"zh:__unavailable__": true` makes every Chinese lookup unavailable. A missing key means not-found.
- `parseZh(raw)` lives in a new file `src/main/dictionary/parseZh.ts`. It never throws.
  1. Drop the head (`headword | pron |`).
  2. Split into senses at circled numbers ①–⑳. With no circled numbers, the body is one sense.
  3. For each sense:
     - Keep the text before the first `▸` (examples are dropped).
     - Remove `«…»`, `‹…›` and `(…)` groups.
     - Split on `;`.
     - From each piece take the first run that starts with a CJK ideograph and continues until a Latin letter, i.e. the pinyin. `…` inside a run is kept (`出…的题目`, `靠…运转`).
     - Trim, drop empties and duplicates, and join with `；`.
  4. Keep at most 4 senses that have Chinese. Gloss = one sense → `缓和；减轻`; several → `① 机缘凑巧 ② 巧事` (renumbered from ①).
  5. `entry` (full text for "More"): the body with line breaks before `A.`/`B.`… parts, before circled numbers and before `▸`, whitespace collapsed per line. Pinyin is kept here.

  Expected glosses:

  | Word | Gloss |
  |---|---|
  | serendipity | `① 机缘凑巧 ② 巧事` |
  | mitigate | `缓和；减轻` |
  | ephemeral | `① 短暂的 ② 短生的` |
  | ubiquitous | `普遍存在的` |
  | epistemology | `认识论` |
  | hegemony | `领导权；支配权` |
  | set | `① 放置；安置 ② 确定；树立 ③ 设定 ④ 使开始` |
  | running | `① 跑 ② 跑步 ③ 参加赛跑 ④ 逃跑` |

- **Vocab:**
  - `VocabWord` and `NewVocab` gain optional `zh?: string | null` (gloss) and `zhEntry?: string | null`.
    - `undefined` means "never looked up in Chinese".
    - `null` means "looked up, not found".
  - `save` stores them when given. A re-save never overwrites an existing gloss with `undefined`.
  - `vocab.md` adds `中文：<gloss>` under the definition when present.
- **Backfill:** `VocabStore.backfillZh(lookup)`.
  - For every word whose `zh === undefined`, run the Chinese lookup on its headword (sequentially).
  - Store `ok` → gloss + entry, `not-found` → `null`, `unavailable` → stop the whole run and leave the rest `undefined` so a later run retries.
  - Run it in the background after a workspace opens and again whenever a lookup returns `zh.status === 'ok'` while some words are still `undefined`; never two at once.
  - Emit review-changed when something changed.
  - The service exposes a Chinese-only lookup for this.
- **Review:** word `ReviewCard`s gain `zh?: string | null` from the word.

## 4. Renderer
- **Look Up popup:**
  - Under the headword/pronunciation line, the gloss is shown at a slightly larger size (`data-testid="lookup-zh"`), above the English definition.
  - A small "More" toggle (`lookup-zh-more`) expands the full Chinese entry in the scroll area.
  - When `zh.status === 'unavailable'`: one muted line, "For Chinese, turn on 'Simplified Chinese – English' in Dictionary → Settings." (`lookup-zh-hint`).
  - Not-found shows nothing.
  - The auto-save passes `zh`/`zhEntry` (`null` for not-found, omitted for unavailable).
- **Word card back:** order is pronunciation, gloss (`review-zh`, prominent), English definition, sentence. The front is unchanged: the headword only, so Chinese does not give the answer away.
- **Vocabulary view:** the gloss is shown on the row after the headword. Search also matches `zh`. The expanded row shows `zhEntry` under the English definition, behind "More".

## 5. Coach, docs, release
- **Coach:** the template root files mention the `中文` line in `vocab.md`. One sentence is enough.
- **README:** a Chinese section, including how to enable the dictionary.
- **Release:** version 0.4.0, tag `v0.4.0`.
- **Tests:**
  - parseZh unit tests built from the fixture samples (all the glosses in the table above, plus the 蚺 rejection, an empty input and garbage input).
  - Service tests for retry, cross-reference following, stub and unavailable.
  - Vocab tests for backfill and for not overwriting.
  - The e2e vocab spec checks `lookup-zh` and `review-zh` with the stub.
