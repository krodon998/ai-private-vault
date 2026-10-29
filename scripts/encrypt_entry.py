import argparse
import base64
import json
import os
import secrets
from datetime import datetime, timezone
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def b64u(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def make_source_tag() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"AI-VAULT-{stamp}-{secrets.token_hex(4)}"


parser = argparse.ArgumentParser()
parser.add_argument("input", help="UTF-8 明文文件")
parser.add_argument("--output", default="envelope.json")
args = parser.parse_args()

plaintext = Path(args.input).read_text(encoding="utf-8")
tag = make_source_tag()
public_key = serialization.load_pem_public_key(Path("public_key.pem").read_bytes())

aes_key = AESGCM.generate_key(bit_length=256)
iv = os.urandom(12)
ciphertext = AESGCM(aes_key).encrypt(iv, plaintext.encode(), tag.encode())
encrypted_key = public_key.encrypt(
    aes_key,
    padding.OAEP(
        mgf=padding.MGF1(hashes.SHA256()),
        algorithm=hashes.SHA256(),
        label=None,
    ),
)

payload = {
    "format": "ai-private-vault-envelope",
    "version": 1,
    "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    "source_tag": tag,
    "cipher_envelope": {
        "version": 1,
        "alg": "RSA-OAEP-256+A256GCM",
        "key_version": 1,
        "encrypted_key": b64u(encrypted_key),
        "iv": b64u(iv),
        "ciphertext": b64u(ciphertext),
        "aad": tag,
    },
}
Path(args.output).write_text(
    json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
)
print(tag)

