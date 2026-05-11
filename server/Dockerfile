# syntax=docker/dockerfile:1

FROM python:3.13-slim

WORKDIR /app

ENV ORDER_API_HOST=0.0.0.0
ENV ORDER_API_PORT=10000
ENV ORDER_API_DB_PATH=/var/data/su-order-api/orders.db
ENV ORDER_API_SLIPS_DIR=/var/data/su-order-api/slips

COPY server/order_api.py ./order_api.py

RUN mkdir -p /var/data/su-order-api/slips

EXPOSE 10000

CMD ["python", "/app/order_api.py"]
