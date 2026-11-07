# The languages Transcribe is tested on (Reuben, 2026-11-05: "the most common in the youtube translate
# tab … that offers enough for its userbase"). FLEURS folder → Whisper's language code, and whether the
# language is written without spaces (scored by letters, not words).
LANGS = {
    'en_us': ('en', 'English', False),
    'es_419': ('es', 'Spanish', False),
    'fr_fr': ('fr', 'French', False),
    'de_de': ('de', 'German', False),
    'pt_br': ('pt', 'Portuguese', False),
    'it_it': ('it', 'Italian', False),
    'nl_nl': ('nl', 'Dutch', False),
    'ru_ru': ('ru', 'Russian', False),
    'pl_pl': ('pl', 'Polish', False),
    'tr_tr': ('tr', 'Turkish', False),
    'uk_ua': ('uk', 'Ukrainian', False),
    'ar_eg': ('ar', 'Arabic', False),
    'hi_in': ('hi', 'Hindi', False),
    'vi_vn': ('vi', 'Vietnamese', False),
    'id_id': ('id', 'Indonesian', False),
    'ja_jp': ('ja', 'Japanese', True),
    'ko_kr': ('ko', 'Korean', True),
    'cmn_hans_cn': ('zh', 'Chinese', True),
}
