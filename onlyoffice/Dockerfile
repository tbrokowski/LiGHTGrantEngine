# OnlyOffice Document Server for co-editing budget workbooks (.xlsx / .xlsm).
#
# Railway (and any host with IPv6 enabled) breaks the stock image: Debian's
# default nginx site and OnlyOffice's ds.conf both declare
# `listen [::]:80 default_server`, nginx refuses to start, and every request
# gets a 502. The image only strips its IPv6 listener when IPv6 is missing, so
# drop the unused default site instead.
FROM onlyoffice/documentserver:8.3

RUN rm -f /etc/nginx/sites-enabled/default

# The startup script otherwise sizes nginx worker_connections to the open-file
# limit (1,048,576 on Railway).
ENV JWT_ENABLED=true \
    NGINX_WORKER_CONNECTIONS=4096

EXPOSE 80
