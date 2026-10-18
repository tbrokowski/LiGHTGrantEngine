# OnlyOffice Document Server for co-editing budget workbooks (.xlsx / .xlsm).
#
# The stock image's nginx fails to start on Railway (every request is a 502):
# with IPv6 present, Debian's default site and OnlyOffice's ds.conf both claim
# `[::]:80 default_server`, and the stock script only strips its IPv6 listener
# when IPv6 is missing. Railway's proxy and private network both reach the
# container over IPv4, so serve on IPv4 only and drop the unused default site.
FROM onlyoffice/documentserver:8.3

RUN rm -f /etc/nginx/sites-enabled/default \
 && tmpl=/etc/onlyoffice/documentserver/nginx/ds.conf.tmpl \
 && grep -q 'listen' "$tmpl" \
 && sed -i '/listen\s\+\[::[0-9]*\]/d' "$tmpl" \
 && ! grep -q '\[::' "$tmpl"

COPY start.sh /app/light-start.sh
RUN chmod +x /app/light-start.sh

# The startup script otherwise sizes nginx worker_connections to the open-file
# limit (1,048,576 on Railway).
ENV JWT_ENABLED=true \
    NGINX_WORKER_CONNECTIONS=4096

EXPOSE 80
ENTRYPOINT ["/app/light-start.sh"]
