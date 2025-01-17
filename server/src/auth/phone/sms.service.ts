import { AuthenticationService } from '../authentication.service'
import { Injectable, Logger } from '@nestjs/common'
import { Prisma, SmsVerifyCodeType } from '@prisma/client'
import Dysmsapi, * as dysmsapi from '@alicloud/dysmsapi20170525'
import * as OpenApi from '@alicloud/openapi-client'
import * as Util from '@alicloud/tea-util'
import {
  ALISMS_KEY,
  LIMIT_CODE_PER_IP_PER_DAY,
  MILLISECONDS_PER_DAY,
  MILLISECONDS_PER_MINUTE,
  CODE_VALIDITY,
} from 'src/constants'
import { PrismaService } from 'src/prisma/prisma.service'
import { SmsVerifyCodeState } from '../types'

@Injectable()
export class SmsService {
  private logger = new Logger(SmsService.name)
  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthenticationService,
  ) {}

  /**
   * send sms login code to given phone number
   * @param dto phone number
   * @param ip client ip
   */
  async sendPhoneCode(phone: string, code: string) {
    try {
      this.logger.debug(`send sms code: ${code} to ${phone}`)

      const res = await this.sendAlismsCode(phone, code.toString())
      if (res.body.code !== 'OK') {
        return `ALISMS_ERROR: ${res.body.message}`
      }
      return null
    } catch (error) {
      this.logger.error(error, error.response?.body)
      return error.message
    }
  }

  // check if phone number satisfy the send condition
  async checkSendable(phone: string, ip: string) {
    // Check if valid phone number
    if (!/^1[3456789]\d{9}$/.test(phone)) {
      return 'INVALID_PHONE'
    }

    // Check if phone number has been send sms code in 1 minute
    const count = await this.prisma.smsVerifyCode.count({
      where: {
        phone: phone,
        createdAt: {
          gt: new Date(Date.now() - MILLISECONDS_PER_MINUTE),
        },
      },
    })
    if (count > 0) {
      return 'REQUEST_OVERLIMIT: phone number has been send sms code in 1 minute'
    }

    // Check if ip has been send sms code beyond 30 times in 24 hours
    const countIps = await this.prisma.smsVerifyCode.count({
      where: {
        ip: ip,
        createdAt: {
          gt: new Date(Date.now() - MILLISECONDS_PER_DAY),
        },
      },
    })
    if (countIps > LIMIT_CODE_PER_IP_PER_DAY) {
      return `REQUEST_OVERLIMIT: ip has been send sms code beyond ${LIMIT_CODE_PER_IP_PER_DAY} times in 24 hours`
    }

    return null
  }

  // save sended code to database
  async saveSmsCode(data: Prisma.SmsVerifyCodeCreateInput) {
    await this.prisma.smsVerifyCode.create({
      data,
    })
  }

  // Valid given phone and code with code type
  async validCode(phone: string, code: string, type: SmsVerifyCodeType) {
    const total = await this.prisma.smsVerifyCode.count({
      where: {
        phone,
        code,
        type,
        state: SmsVerifyCodeState.Active,
        createdAt: { gte: new Date(Date.now() - CODE_VALIDITY) },
      },
    })

    if (total === 0) return 'invalid code'
    // Disable verify code after valid
    await this.disableCode(phone, code, type)
    return null
  }

  // Disable verify code
  async disableCode(phone: string, code: string, type: SmsVerifyCodeType) {
    await this.prisma.smsVerifyCode.updateMany({
      where: {
        phone,
        code,
        type,
        state: SmsVerifyCodeState.Active,
      },
      data: {
        state: SmsVerifyCodeState.Used,
      },
    })
  }

  // Disable same type verify code
  async disableSameTypeCode(phone: string, type: SmsVerifyCodeType) {
    await this.prisma.smsVerifyCode.updateMany({
      where: {
        phone,
        type,
        state: SmsVerifyCodeState.Active,
      },
      data: {
        state: SmsVerifyCodeState.Used,
      },
    })
  }

  // send sms code to phone using alisms
  private async sendAlismsCode(phone: string, code: string) {
    const { accessKeyId, accessKeySecret, templateCode, signName, endpoint } =
      await this.loadAlismsConfig()

    const sendSmsRequest = new dysmsapi.SendSmsRequest({
      phoneNumbers: phone,
      signName,
      templateCode,
      templateParam: `{"code":${code}}`,
    })

    const config = new OpenApi.Config({
      accessKeyId,
      accessKeySecret,
      endpoint,
    })

    const client = new Dysmsapi(config)
    const runtime = new Util.RuntimeOptions({})
    return await client.sendSmsWithOptions(sendSmsRequest, runtime)
  }

  // load alisms config from database
  private async loadAlismsConfig() {
    const phoneProvider = await this.authService.getPhoneProvider()
    return phoneProvider.config[ALISMS_KEY]
  }
}
