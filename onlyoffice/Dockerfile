# OnlyOffice Document Server for co-editing budget workbooks (.xlsx / .xlsm).
#
# On Railway the stock image never serves OnlyOffice: an Ubuntu default nginx
# site turns up in sites-enabled at runtime and also claims
# `[::]:80 default_server`. With OnlyOffice's own IPv6 listener nginx refuses
# to start (502s); without it the default site answers Railway's proxy, which
# connects over IPv6, with 404s. OnlyOffice only uses conf.d, so stop nginx
# reading sites-enabled at all.
FROM onlyoffice/documentserver:8.3

RUN rm -f /etc/nginx/sites-enabled/default \
 && sed -i '/include\s\+\/etc\/nginx\/sites-enabled/d' /etc/nginx/nginx.conf \
 && ! grep -q 'sites-enabled' /etc/nginx/nginx.conf \
 && grep -q 'conf.d' /etc/nginx/nginx.conf

COPY start.sh /app/light-start.sh
RUN chmod +x /app/light-start.sh

# The startup script otherwise sizes nginx worker_connections to the open-file
# limit (1,048,576 on Railway).
ENV JWT_ENABLED=true \
    NGINX_WORKER_CONNECTIONS=4096

EXPOSE 80
ENTRYPOINT ["/app/light-start.sh"]
