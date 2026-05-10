FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV SHELL=/usr/bin/zsh

ARG USERNAME=dev
ARG UID=1000
ARG GID=1000

# Minimal bootstrap needed so install.sh can do the real provisioning.
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    openssh-server \
    sudo \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid "${GID}" "${USERNAME}" \
    && useradd --uid "${UID}" --gid "${GID}" -m -s /bin/bash "${USERNAME}" \
    && echo "${USERNAME} ALL=(ALL) NOPASSWD:ALL" > "/etc/sudoers.d/${USERNAME}" \
    && chmod 0440 "/etc/sudoers.d/${USERNAME}"

# SSH base config for Prime Intellect / on-demand cloud access.
RUN mkdir -p /var/run/sshd \
    && sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config \
    && sed -i 's@session\s*required\s*pam_loginuid.so@session optional pam_loginuid.so@g' /etc/pam.d/sshd \
    && ssh-keygen -A

WORKDIR /opt/dotfiles
COPY --chown=${USERNAME}:${USERNAME} . /opt/dotfiles

USER ${USERNAME}
ENV HOME=/home/${USERNAME}
ENV BUN_INSTALL=/home/${USERNAME}/.bun
ENV PATH=/home/${USERNAME}/.bun/bin:/home/${USERNAME}/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Phase 1: keep the proven installer as the build-time provisioner.
RUN bash ./install.sh

USER root

# zsh as the login shell for SSH sessions and normal user shells.
RUN chsh -s /usr/bin/zsh "${USERNAME}" \
    && chsh -s /usr/bin/zsh root

COPY docker/prime-template/entrypoint.sh /usr/local/bin/prime-template-entrypoint.sh
RUN chmod 0755 /usr/local/bin/prime-template-entrypoint.sh

EXPOSE 22

ENTRYPOINT ["/usr/local/bin/prime-template-entrypoint.sh"]
CMD ["sshd"]
