import { AuthenticationService } from '../authentication.service'
import { UserPasswordService } from './user-password.service'
import { Body, Controller, Logger, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { ResponseUtil } from 'src/utils/response'
import { UserService } from '../../user/user.service'
import { PasswdSignupDto } from '../dto/passwd-signup.dto'
import { PasswdSigninDto } from '../dto/passwd-signin.dto'
import { AuthBindingType, AuthProviderBinding } from '../types'
import { SmsService } from '../phone/sms.service'
import { PasswdResetDto } from '../dto/passwd-reset.dto'
import { IRequest } from 'src/utils/interface'
import { PASSWORD_AUTH_PROVIDER_NAME } from 'src/constants'

@ApiTags('Authentication - New')
@Controller('auth')
export class UserPasswordController {
  private readonly logger = new Logger(UserPasswordService.name)
  constructor(
    private readonly userService: UserService,
    private readonly passwdService: UserPasswordService,
    private readonly authService: AuthenticationService,
    private readonly smsService: SmsService,
  ) {}

  /**
   * Signup by username and password
   */
  @ApiOperation({ summary: 'Signup by user-password' })
  @ApiResponse({ type: ResponseUtil })
  @Post('passwd/signup')
  async signup(@Body() dto: PasswdSignupDto) {
    const { username, password, phone } = dto
    // check if user exists
    const doc = await this.userService.user({ username })
    if (doc) {
      return ResponseUtil.error('user already exists')
    }

    // check if register is allowed
    const provider = await this.authService.getPasswdProvider()
    if (provider.register === false) {
      return ResponseUtil.error('register is not allowed')
    }

    // valid phone code if needed
    const bind = provider.bind as any as AuthProviderBinding
    if (bind.phone === AuthBindingType.Required) {
      const { phone, code, type } = dto
      // valid phone has been binded
      const user = await this.userService.findByPhone(phone)
      if (user) {
        return ResponseUtil.error('phone has been binded')
      }
      const err = await this.smsService.validCode(phone, code, type)
      if (err) {
        return ResponseUtil.error(err)
      }
    }

    // signup user
    const user = await this.passwdService.signup(username, password, phone)

    // signin for created user
    const token = this.passwdService.signin(user)
    if (!token) {
      return ResponseUtil.error('failed to get access token')
    }
    return ResponseUtil.ok({ token, user })
  }

  /**
   * Signin by username and password
   */
  @ApiOperation({ summary: 'Signin by user-password' })
  @ApiResponse({ type: ResponseUtil })
  @Post('passwd/signin')
  async signin(@Body() dto: PasswdSigninDto) {
    // check if user exists
    const user = await this.userService.find(dto.username)
    if (!user) {
      return ResponseUtil.error('user not found')
    }

    // check if password is correct
    const err = await this.passwdService.validPasswd(user.id, dto.password)
    if (err) {
      return ResponseUtil.error(err)
    }

    // signin for user
    const token = await this.passwdService.signin(user)
    if (!token) {
      return ResponseUtil.error('failed to get access token')
    }
    return ResponseUtil.ok(token)
  }

  /**
   * Reset password
   */
  @ApiOperation({ summary: 'Reset password' })
  @ApiResponse({ type: ResponseUtil })
  @Post('passwd/reset')
  async reset(@Body() dto: PasswdResetDto, @Req() req: IRequest) {
    // valid phone code
    const { phone, code, type } = dto
    let err = await this.smsService.validCode(phone, code, type)
    if (err) {
      return ResponseUtil.error(err)
    }

    // reset password
    err = await this.passwdService.resetPasswd(req.user.id, dto.password)
    if (err) {
      return ResponseUtil.error(err)
    }

    return ResponseUtil.ok('success')
  }
}
