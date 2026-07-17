import boto3
from io import BytesIO
from urllib.parse import unquote_plus
from PIL import Image

s3 = boto3.client("s3")

RESIZE_TARGET = (300, 300)
SOURCE_PREFIX = "uploads/"
DEST_PREFIX = "resized/"
SUPPORTED_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")


def lambda_handler(event, context):

    for record in event.get("Records", []):

        bucket = record["s3"]["bucket"]["name"]
        raw_key = record["s3"]["object"]["key"]
        key = unquote_plus(raw_key)

        print(f"Processing s3://{bucket}/{key}")

        # Process only uploads/
        if not key.startswith(SOURCE_PREFIX):
            continue

        # Skip unsupported files
        if not key.lower().endswith(SUPPORTED_EXTENSIONS):
            continue

        filename = key[len(SOURCE_PREFIX):]
        destination_key = DEST_PREFIX + filename

        response = s3.get_object(
            Bucket=bucket,
            Key=key
        )

        image_bytes = response["Body"].read()
        content_type = response.get("ContentType", "image/jpeg")

        with Image.open(BytesIO(image_bytes)) as img:

            if img.mode in ("RGBA", "P") and filename.lower().endswith((".jpg", ".jpeg")):
                img = img.convert("RGB")

            img.thumbnail(RESIZE_TARGET, Image.LANCZOS)

            output = BytesIO()

            if filename.lower().endswith(".png"):
                fmt = "PNG"
            elif filename.lower().endswith(".webp"):
                fmt = "WEBP"
            else:
                fmt = "JPEG"

            img.save(
                output,
                format=fmt,
                quality=85,
                optimize=True
            )

            output.seek(0)

        s3.put_object(
            Bucket=bucket,
            Key=destination_key,
            Body=output,
            ContentType=content_type
        )

        print(
            f"Successfully resized -> s3://{bucket}/{destination_key}"
        )

    return {
        "statusCode": 200,
        "body": "Processing complete"
    }
