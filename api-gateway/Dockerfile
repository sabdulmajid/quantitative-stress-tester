FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY go.sum ./
COPY cmd ./cmd
COPY internal ./internal
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/api-gateway ./cmd/api-gateway

FROM gcr.io/distroless/static:nonroot
COPY --from=build /out/api-gateway /api-gateway
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/api-gateway"]
