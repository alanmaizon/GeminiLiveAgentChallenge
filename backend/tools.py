"""
Tool definitions and executors for Logos.

In production (non-mock) mode, tool execution uses a separate Gemini call to
generate structured philological data. In mock mode, hardcoded examples are used.
"""

from typing import Any
import json

# ── Tool function declarations (sent to Gemini) ───────────────────────────────

TOOL_DECLARATIONS = [
    {
        "name": "parse_greek",
        "description": (
            "Analyze the morphology of an Ancient Greek word. Returns part of speech, "
            "tense, mood, voice, person, number, gender, case, degree as applicable, "
            "plus lemma, definition, and principal parts for verbs."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "word": {
                    "type": "string",
                    "description": "The Greek word to parse, in Unicode Greek",
                },
                "context": {
                    "type": "string",
                    "description": "Optional: the sentence or phrase containing the word",
                },
            },
            "required": ["word"],
        },
    },
    {
        "name": "lookup_lexicon",
        "description": (
            "Look up a Greek word in the lexicon. Returns a summary entry with "
            "definitions, usage notes, and key references."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "lemma": {
                    "type": "string",
                    "description": "The dictionary form (lemma) of the Greek word",
                }
            },
            "required": ["lemma"],
        },
    },
    {
        "name": "scan_meter",
        "description": (
            "Perform metrical scansion on a line of Greek verse. Returns the scansion "
            "pattern, meter type, and any notable features."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "line": {
                    "type": "string",
                    "description": "The line of Greek verse to scan",
                },
                "expected_meter": {
                    "type": "string",
                    "description": "Optional: expected meter type",
                },
            },
            "required": ["line"],
        },
    },
]

# ── Mock results ──────────────────────────────────────────────────────────────

MOCK_PARSES: dict[str, Any] = {
    "μῆνιν": {
        "word": "μῆνιν",
        "lemma": "μῆνις",
        "transliteration": "mēnin",
        "part_of_speech": "Noun",
        "gender": "Feminine",
        "case": "Accusative",
        "number": "Singular",
        "definition": "wrath, rage, anger (of a god or hero)",
        "notes": "Opening word of the Iliad. The accusative singular marks it as the direct object of ἄειδε (sing!).",
    },
    "λύομεν": {
        "word": "λύομεν",
        "lemma": "λύω",
        "transliteration": "lyomen",
        "part_of_speech": "Verb",
        "tense": "Present",
        "voice": "Active",
        "mood": "Indicative",
        "person": "1st",
        "number": "Plural",
        "definition": "we loose / we are loosing",
        "principal_parts": "λύω, λύσω, ἔλυσα, λέλυκα, λέλυμαι, ἐλύθην",
    },
    "ἄνθρωπος": {
        "word": "ἄνθρωπος",
        "lemma": "ἄνθρωπος",
        "transliteration": "anthrōpos",
        "part_of_speech": "Noun",
        "gender": "Masculine",
        "case": "Nominative",
        "number": "Singular",
        "definition": "human being, man (as opposed to gods or animals)",
        "ipa": "/án.tʰrɔː.pos/",
    },
    "default": {
        "word": "—",
        "lemma": "—",
        "transliteration": "—",
        "part_of_speech": "Unknown",
        "definition": "Parse unavailable in mock mode for this word.",
        "notes": "Connect with a live Gemini API key for full morphological analysis.",
    },
}

MOCK_LEXICON: dict[str, Any] = {
    "μῆνις": {
        "lemma": "μῆνις",
        "transliteration": "mēnis",
        "part_of_speech": "Noun, Feminine, 3rd declension",
        "definitions": [
            "wrath, rage (esp. of the gods)",
            "lasting anger, divine displeasure",
        ],
        "usage": "Rare outside epic. Always of superhuman or heroic rage. Contrast θυμός (thumos), the more general word for passion.",
        "key_refs": ["Il. 1.1", "Il. 1.75", "Od. 3.135"],
    },
    "λύω": {
        "lemma": "λύω",
        "transliteration": "lyō",
        "part_of_speech": "Verb",
        "definitions": [
            "to loose, unbind, release",
            "to dissolve, destroy",
            "to ransom",
        ],
        "usage": "Common verb; paradigmatic for learning the -ω conjugation in Attic Greek.",
        "principal_parts": "λύω, λύσω, ἔλυσα, λέλυκα, λέλυμαι, ἐλύθην",
    },
}

MOCK_SCANSION: dict[str, Any] = {
    "μῆνιν ἄειδε θεά Πηληϊάδεω Ἀχιλῆος": {
        "line": "μῆνιν ἄειδε θεά Πηληϊάδεω Ἀχιλῆος",
        "meter": "Dactylic Hexameter",
        "pattern": "— ∪∪ | — — | — ∪∪ | — ∪∪ | — ∪∪ | — —",
        "analysis": "Foot 1: spondee (μῆνιν); Foot 2: spondee; Foot 3: dactyl; typical Iliadic opening rhythm.",
    }
}


def execute_tool_mock(tool_name: str, args: dict[str, Any]) -> Any:
    """Return hardcoded mock results for tool calls."""
    if tool_name == "parse_greek":
        word = args.get("word", "")
        return MOCK_PARSES.get(word, {**MOCK_PARSES["default"], "word": word})

    if tool_name == "lookup_lexicon":
        lemma = args.get("lemma", "")
        return MOCK_LEXICON.get(
            lemma,
            {
                "lemma": lemma,
                "definitions": ["Entry not found in mock lexicon."],
                "usage": "Connect with a live API key for full LSJ entries.",
            },
        )

    if tool_name == "scan_meter":
        line = args.get("line", "")
        return MOCK_SCANSION.get(
            line,
            {
                "line": line,
                "meter": "Dactylic Hexameter (mock)",
                "pattern": "— ∪∪ | — — | — ∪∪ | — ∪∪ | — ∪∪ | — —",
                "analysis": "Scansion unavailable in mock mode.",
            },
        )

    return {"error": f"Unknown tool: {tool_name}"}


async def execute_tool_live(
    tool_name: str, args: dict[str, Any], gemini_client: Any
) -> Any:
    """
    Execute a tool using a separate Gemini non-streaming call for structured output.
    Falls back to mock if the call fails.
    """
    # GEMINI_LIVE: wire structured tool execution via a non-streaming Gemini call
    # Example prompt for parse_greek:
    #   "Return a JSON morphological analysis of the Ancient Greek word '{word}'.
    #    Include: lemma, transliteration, part_of_speech, tense, voice, mood,
    #    person, number, gender, case, definition, principal_parts (if verb).
    #    Respond ONLY with valid JSON."
    try:
        from google import genai

        word = args.get("word", args.get("lemma", args.get("line", "")))
        if tool_name == "parse_greek":
            prompt = (
                f"Return a JSON morphological analysis of the Ancient Greek word '{word}'. "
                "Include fields: word, lemma, transliteration, part_of_speech, tense (if verb), "
                "voice (if verb), mood (if verb), person (if verb), number, gender (if noun/adj), "
                "case (if noun/adj), definition, principal_parts (if verb), ipa (if known). "
                "Respond ONLY with valid JSON, no markdown."
            )
        elif tool_name == "lookup_lexicon":
            prompt = (
                f"Return a JSON lexicon entry for the Ancient Greek lemma '{word}' "
                "in LSJ style. Include: lemma, transliteration, part_of_speech, "
                "definitions (array), usage, key_refs (array). Respond ONLY with valid JSON."
            )
        elif tool_name == "scan_meter":
            context = args.get("expected_meter", "dactylic hexameter")
            prompt = (
                f"Return a JSON metrical scansion for the line of Greek verse: '{word}'. "
                f"Expected meter: {context}. Include: line, meter, pattern (using — and ∪∪), "
                "analysis. Respond ONLY with valid JSON."
            )
        else:
            return execute_tool_mock(tool_name, args)

        if gemini_client is None:
            return execute_tool_mock(tool_name, args)

        response = gemini_client.models.generate_content(
            model="gemini-2.0-flash-001",
            contents=prompt,
        )
        text = response.text.strip()
        # Strip markdown code fences if present
        if text.startswith("```"):
            text = text.split("\n", 1)[1].rsplit("```", 1)[0]
        return json.loads(text)

    except Exception:
        return execute_tool_mock(tool_name, args)
