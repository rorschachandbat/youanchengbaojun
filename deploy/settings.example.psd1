@{
    # 复制为同目录的 settings.psd1，再填写自己的服务器与本机私钥路径。
    # 示例地址不可用于真实部署；私钥文件绝不能放入待提交目录。
    Server = 'server.example.com'
    KeyPath = '~/.ssh/id_ed25519'
    User = 'deploy-user'
    SshPort = 22
    ControlPort = 8080
    InstallRoot = '/opt/tyrants'
    NodeBin = '/usr/bin/node'
    SmokePort = 18080
}
