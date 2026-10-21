#!/bin/sh

set -e

ENVSUBST="envsubst"

INPUT="./seeds.sql"
OUTPUT="./output/02-initdata.sql"
env

if [ -f "$OUTPUT" ]; then
    echo "Output file already exists. Skipping."
    exit 0
fi

export SAML_SERVICE_PROVIDER_EREADER_ENCRYPTION_CERTIFICATE=$(cat sp-read-encrypt.crt)
export SAML_SERVICE_PROVIDER_EREADER_ENCRYPTION_PRIVATE_KEY=$(cat sp-read-encrypt.key)
export SHIBBOLETH_IDENTITY_PROVIDER_SIGNING_CERTIFICATE=$(cat idp-signing.crt)

$ENVSUBST < "$INPUT" > "$OUTPUT"
