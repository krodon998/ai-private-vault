import base64
import json
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


def b64u(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
public_key = private_key.public_key()

private_pem = private_key.private_bytes(
    serialization.Encoding.PEM,
    serialization.PrivateFormat.PKCS8,
    serialization.NoEncryption(),
)
public_pem = public_key.public_bytes(
    serialization.Encoding.PEM,
    serialization.PublicFormat.SubjectPublicKeyInfo,
)

numbers = public_key.public_numbers()
jwk = {
    "kty": "RSA",
    "alg": "RSA-OAEP-256",
    "use": "enc",
    "n": b64u(numbers.n.to_bytes((numbers.n.bit_length() + 7) // 8, "big")),
    "e": b64u(numbers.e.to_bytes((numbers.e.bit_length() + 7) // 8, "big")),
}

Path("private_key.pem").write_bytes(private_pem)
Path("public_key.pem").write_bytes(public_pem)
Path("public_key.jwk.json").write_text(
    json.dumps(jwk, indent=2), encoding="utf-8"
)
print("已生成 private_key.pem、public_key.pem、public_key.jwk.json")

