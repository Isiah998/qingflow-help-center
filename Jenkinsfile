pipeline {
  agent any

  triggers {
    cron('H H/6 * * *')
  }

  options {
    disableConcurrentBuilds()
    timeout(time: 60, unit: 'MINUTES')
    timestamps()
    buildDiscarder(logRotator(numToKeepStr: '20'))
    skipDefaultCheckout(true)
  }

  stages {
    stage('Checkout') {
      steps {
        checkout scm
      }
    }

    stage('Protect production branch') {
      steps {
        script {
          def branch = env.BRANCH_NAME ?: env.GIT_BRANCH ?: ''
          if (!(branch == 'main' || branch.endsWith('/main'))) {
            error("Production releases are restricted to main; received '${branch ?: 'unknown'}'.")
          }
        }
      }
    }

    stage('Build and release') {
      steps {
        sh 'bash scripts/jenkins-release.sh'
      }
    }
  }
}
